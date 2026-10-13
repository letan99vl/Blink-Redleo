#include <cassert>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <vector>
#include "fw24_extracted.h"

using namespace BlinkGuard;

static void seal(std::vector<uint8_t> &f) {
  assert(f.size() >= 3);
  f.back() = static_cast<uint8_t>(0xFFu - f[0]);
  uint8_t sum=0;
  for (size_t i=0;i<f.size()-2;i++) sum=static_cast<uint8_t>(sum+f[i]);
  f[f.size()-2]=sum;
}
static std::vector<uint8_t> handshake(const char* fw,unsigned bank,size_t size=41) {
  std::vector<uint8_t> f(size,0);
  f[0]=0x5A;
  if (size>=35) {
    std::memcpy(f.data()+1,"YAMAHA LC150    ",16);
    std::memcpy(f.data()+17,fw,4);
    f[33]=static_cast<uint8_t>(bank-1);
  }
  seal(f);
  return f;
}
static std::vector<uint8_t> live(uint16_t rpm) {
  std::vector<uint8_t> f(53,0);
  f[0]=0xA1; f[6]=static_cast<uint8_t>(rpm>>8);
  f[7]=static_cast<uint8_t>(rpm&0xFF);
  seal(f);
  return f;
}
static std::vector<uint8_t> limitPage(uint8_t page,uint16_t rpm,size_t len) {
  std::vector<uint8_t> f(len,0);
  f[0]=page;f[5]=static_cast<uint8_t>(rpm>>8);
  f[6]=static_cast<uint8_t>(rpm&0xFF); seal(f);
  return f;
}

int main() {
  using namespace BlinkAutoPins;
  static_assert(SLOT_COUNT == 2, "Only known production wiring is allowed");
  assert(PAIRS[0].rx==22 && PAIRS[0].tx==23);
  assert(PAIRS[1].rx==26 && PAIRS[1].tx==33);
  assert(otherSlot(0)==1 && otherSlot(1)==0);
  assert(DEFAULT_SLOT==0);

  uint8_t tx[5];
  request5(0x5A,0x5A,tx);
  assert(isHandshakeRequest(tx,5));
  assert(!isLiveRequest(tx,5));
  assert(!isHandshakeRequest(tx,4));
  tx[2]^=1;
  assert(!isHandshakeRequest(tx,5));
  request5(0x69,4,tx);
  assert(isLiveRequest(tx,5));
  assert(!isHandshakeRequest(tx,5));
  request5(0xCD,0x62,tx);
  assert(!isLiveRequest(tx,5));
  assert(!isHandshakeRequest(tx,5));

  Handshake parsed{};
  for (size_t size : {(size_t)37,(size_t)41}) {
    auto f=handshake("9.23",2,size);
    assert(validHandshakeReply(f.data(),f.size()));
    assert(parseHandshake(f.data(),f.size(),parsed) && parsed.map==2);
    f[33]=7;seal(f);assert(!validHandshakeReply(f.data(),f.size()));
    f=handshake("9.23",2,size);f[17]=4;seal(f);
    assert(!validHandshakeReply(f.data(),f.size()));
    f=handshake("9.23",2,size);f[20]^=1;
    assert(!validHandshakeReply(f.data(),f.size()));
  }
  for (const char* fw : {"8.02","10.2","11.1"}) {
    auto f=handshake(fw,1);
    assert(validHandshakeReply(f.data(),f.size())); // pins work on OTHER ECU too
    assert(!parseHandshake(f.data(),f.size(),parsed)); // guard stays disarmed
  }
  auto shortHs=handshake("",1,9);
  assert(validHandshakeReply(shortHs.data(),shortHs.size()));
  assert(!parseHandshake(shortHs.data(),shortHs.size(),parsed));
  auto bad=handshake("9.23",1);bad[8]^=1;
  assert(!validHandshakeReply(bad.data(),bad.size()));
  std::vector<uint8_t> empty;assert(!validHandshakeReply(empty.data(),0));

  for (uint16_t rpm : {0,800,7750,8000,12000,20000}) {
    auto f=live(rpm);
    assert(validLiveReply(f.data(),f.size()));
    f[25]^=1;
    assert(!validLiveReply(f.data(),f.size()));
  }
  auto overRpm=live(20001);
  assert(!validLiveReply(overRpm.data(),overRpm.size()));
  auto brokenSize=live(8000); brokenSize.pop_back();
  assert(!validLiveReply(brokenSize.data(),brokenSize.size()));

  uint16_t rpm=0;
  for (size_t size : {(size_t)33,(size_t)65,(size_t)66}) {
    auto f=limitPage(0x62,8000,size);
    assert(parseLimit(f.data(),f.size(),0x62,rpm) && rpm==8000);
    assert(!parseLimit(f.data(),f.size(),0x64,rpm));
    f[6]^=1;
    assert(!parseLimit(f.data(),f.size(),0x62,rpm));
  }
  for (uint16_t n : {0,2999,18001,65535}) {
    auto f=limitPage(0x62,n,33);
    assert(!parseLimit(f.data(),f.size(),0x62,rpm));
  }

  Window w;
  w.target(1,8000);
  assert(!w.observe(1000,7750));
  for (uint32_t t=1100;t<6000;t+=100)
    assert(!w.observe(t,7800));
  assert(w.observe(6000,7850)); // exactly five seconds from first near-limit sample
  assert(w.tripped);
  w.target(2,9000); assert(!w.tripped && w.nearMs==0);
  assert(!w.observe(6100,9000));
  w.target(1,8000);w.observe(100,7900);w.observe(200,7900);
  w.stale(801); assert(w.nearMs==0);  // >600 ms dropout resets
  assert(!w.observe(900,7900));
  assert(!w.observe(1901,7900)); // even a stale large interval cannot trip
  w.target(1,8000); w.observe(1000,8000);
  for (uint32_t t=1100;t<3000;t+=100) assert(!w.observe(t,8000));
  assert(!w.observe(3000,6000));
  assert(!w.observe(3100,6000));
  assert(!w.observe(3200,6000));
  assert(!w.observe(3300,6000)); // 400ms dip resets progress
  assert(w.nearMs==0);
  w.target(4,10000);
  for (uint32_t t=3400;t<11000;t+=100) assert(!w.observe(t,10000));

  std::cout << "PASS: firmware one-file cores; RX22/23 and RX26/33; handshake/live checksum;\n"
            << "      unsupported ECU guard locked; RPM page6; 5000ms timer; dip/stale exclusion\n";
}
