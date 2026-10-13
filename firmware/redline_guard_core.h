#pragma once
// BLINK FW 2.3 redline guard: dependency-free, testable ECU parsing / timer logic.
// IMPORTANT: RPM and page 6 MUST be validated before this may command any MAP.
#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace BlinkGuard {
static const uint32_t HOLD_MS = 5000U;
static const uint32_t MAX_SAMPLE_GAP_MS = 600U;
static const uint32_t MAX_DIP_MS = 350U;
static const uint16_t RPM_NEAR_MARGIN = 250U;
static const uint16_t RPM_LIMIT_MIN = 3000U;
static const uint16_t RPM_LIMIT_MAX = 18000U;

inline bool validReply(const uint8_t *f, size_t n) {
  if (!f || n < 3 || (uint8_t)(f[0] + f[n - 1]) != 0xFFU) return false;
  uint8_t sum=0;
  for (size_t i=0; i<n-2; ++i) sum=(uint8_t)(sum+f[i]);
  return sum==f[n-2];
}

struct Handshake {
  uint8_t map=0;
  char fw[5]={0};
  char id[17]={0};
};

// Only verified four-MAP 9.1x/9.2x family, never 9B shortcut/V8/V10/V11.
inline bool parseHandshake(const uint8_t *rx,size_t n,Handshake &out) {
  if (!rx) return false;
  const size_t sizes[]={41,37};
  for (size_t i=0;i<n;++i) {
    if(rx[i]!=0x5A)continue;
    for (size_t size:sizes) {
      if (i+size>n || !validReply(rx+i,size))continue;
      const uint8_t *f=rx+i;
      if (f[17]!='9' || f[18]!='.' ||
          !((f[19]=='1' || f[19]=='2') && f[20]>='0' && f[20]<='9'))continue;
      if (f[33]>3)continue;
      Handshake h;
      h.map=(uint8_t)(f[33]+1);
      for(int j=0;j<4;j++)h.fw[j]=(char)f[17+j];
      for(int j=0;j<16;j++)h.id[j]=(char)f[1+j];
      h.id[16]=0;
      out=h;
      return true;
    }
  }
  return false;
}

inline bool parseLimit(const uint8_t *rx,size_t n,uint8_t page,uint16_t &limit){
  if(!rx || (page&0xF0U)!=0x60U || 
     (page!=0x62 && page!=0x64 && page!=0x66 && page!=0x68))return false;
  const size_t sizes[]={33,65,66}; // V9.1 30B, V9.2 62B or 63B reply payload
  for(size_t i=0;i<n;++i){
    if(rx[i]!=page)continue;
    for(size_t size:sizes){
      if(i+size>n || !validReply(rx+i,size))continue;
      const uint8_t *f=rx+i;
      const uint16_t rpm=(uint16_t)((uint16_t)f[5]<<8 | (uint16_t)f[6]);
      if(rpm<RPM_LIMIT_MIN || rpm>RPM_LIMIT_MAX)return false;
      limit=rpm;
      return true;
    }
  }
  return false;
}

inline void request5(uint8_t cmd,uint8_t arg,uint8_t out[5]){
  uint8_t sum=(uint8_t)(cmd+arg);
  out[0]=cmd;out[1]=arg;out[2]=(uint8_t)(255U-sum);out[3]=sum;out[4]=5;
}

struct Window {
  uint32_t nearMs=0;
  uint32_t dipMs=0;
  uint32_t lastMs=0;
  uint8_t map=0;
  uint16_t limit=0;
  bool hasLast=false;
  bool lastNear=false;
  bool tripped=false;

  void reset(){
    nearMs=0;dipMs=0;lastMs=0;hasLast=false;lastNear=false;tripped=false;
  }
  void target(uint8_t bank,uint16_t maxRpm){
    if(bank!=map || maxRpm!=limit){reset();map=bank;limit=maxRpm;}
  }
  // Caller must only call this on validated 53B 0xA1 samples.
  bool observe(uint32_t now,uint16_t rpm){
    if(tripped)return true;
    if(map<1 || map>3 || limit<RPM_LIMIT_MIN || limit>RPM_LIMIT_MAX ||
       rpm==0 || rpm>20000){reset();return false;}
    const bool near=rpm>=(uint16_t)(limit>RPM_NEAR_MARGIN?limit-RPM_NEAR_MARGIN:limit);
    if(!hasLast){
      hasLast=true;lastMs=now;lastNear=near;return false;
    }
    const uint32_t dt=(uint32_t)(now-lastMs);
    lastMs=now;
    if(dt>MAX_SAMPLE_GAP_MS){reset();hasLast=true;lastMs=now;lastNear=near;return false;}
    if(near){
      dipMs=0;
      // Do not count time at lower RPM as redline.
      if(lastNear)nearMs+=dt;
    }else{
      dipMs+=dt;
      if(dipMs>MAX_DIP_MS){nearMs=0;dipMs=0;}
    }
    lastNear=near;
    if(nearMs>=HOLD_MS){tripped=true;return true;}
    return false;
  }
  void stale(uint32_t now){
    if(hasLast && (uint32_t)(now-lastMs)>MAX_SAMPLE_GAP_MS)reset();
  }
};
} // namespace BlinkGuard
