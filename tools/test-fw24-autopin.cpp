#include <algorithm>
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
static std::vector<uint8_t> handshake(const char* fw,unsigned bank,size_t size=41,const char *ident="YAMAHA LC150    ") {
  std::vector<uint8_t> f(size,0);
  f[0]=0x5A;
  if (size>=35) {
    std::memcpy(f.data()+1,ident,std::min(std::strlen(ident),size_t(16)));
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
static std::vector<uint8_t> limitPage(uint8_t page,uint16_t rpm,size_t len,size_t off=5) {
  std::vector<uint8_t> f(len,0);
  f[0]=page;f[off]=static_cast<uint8_t>(rpm>>8);
  f[off+1]=static_cast<uint8_t>(rpm&0xFF); seal(f);
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
    assert(parseHandshake(f.data(),f.size(),parsed) && parsed.map==2 && parsed.family==V92);
    // Transport must pass REDLEO's checksum-valid 0x5A through to Blink even
    // if its MAP byte / ASCII version is vendor-specific (Ultra Pro1).
    f[33]=7;seal(f);
    assert(validHandshakeReply(f.data(),f.size()));
    assert(!parseHandshake(f.data(),f.size(),parsed)); // guard remains OFF
    f=handshake("9.23",2,size);f[17]=4;seal(f);
    assert(validHandshakeReply(f.data(),f.size()));
    assert(!parseHandshake(f.data(),f.size(),parsed)); // guard never guesses
    f=handshake("9.23",2,size);f[20]^=1;
    assert(!validHandshakeReply(f.data(),f.size()));
  }
  for (const char* fw : {"8.02","11.1","9.30","9.90"}) {
    auto f=handshake(fw,1);
    assert(validHandshakeReply(f.data(),f.size())); // UART pins still work
    assert(!parseHandshake(f.data(),f.size(),parsed)); // unknown limits fail closed
  }
  for (const char* fw : {"9.10","9.19","9.20","9.23","10.2","10.3","10.9"}) {
    auto f=handshake(fw,4);
    const Family want=fw[0]=='1'?V10:(fw[2]=='1'?V91:V92);
    assert(parseHandshake(f.data(),f.size(),parsed));
    assert(parsed.map==4 && parsed.family==want);
  }
  // Do not route Ultra's RPM through 10.x index2: Ultra is index3.
  for(size_t len:{size_t(37),size_t(41)}){
    auto ultra=handshake("10.3",2,len,"REDLEO ULTRA PRO1");
    assert(parseHandshake(ultra.data(),ultra.size(),parsed));
    assert(parsed.family==ULTRA1 && parsed.map==2);
  }
  // Regression: FW2.2 transparently forwards Ultra Pro1's checksum-valid
  // 0x5A response, while 2.6.1 wrongly required MAP byte <=3, printable
  // firmware and lengths <=96. Auto UART used to switch away from a working
  // UART pair, causing Blink/IPA ECU authentication to fail.
  for(size_t size:{size_t(9),size_t(12),size_t(34),size_t(35),size_t(37),
                  size_t(41),size_t(63),size_t(97),size_t(142),size_t(240)}){
    auto ultra=handshake("10.3",2,size,"REDLEO ULTRA PRO1");
    if(size>=35){
      ultra[33]=0x87;   // ECU-specific MAP byte; Blink handles this itself.
      ultra[18]=0x0A;   // non-ASCII version metadata; not a UART fault.
      seal(ultra);
    }
    assert(validHandshakeReply(ultra.data(),ultra.size()));
    auto expected=ultra;
    assert(normalizeHandshake(ultra.data(),ultra.size())==size);
    assert(std::memcmp(ultra.data(),expected.data(),size)==0);
    if(size>=35)
      assert(!parseHandshake(ultra.data(),ultra.size(),parsed));
    expected.back()^=0x01; // corrupt checksum/complement is ALWAYS rejected
    assert(!validHandshakeReply(expected.data(),expected.size()));
  }
  {
    auto validUltra=handshake("10.3",4,41,"REDLEO ULTRA PRO1");
    // Construct a checksum-valid accidental 9B prefix INSIDE a valid 41B
    // full response. FW2.6.1 prioritized short 9B, damaging Ultra identity.
    uint8_t prefixSum=0;
    for(size_t i=0;i<7;i++)prefixSum=(uint8_t)(prefixSum+validUltra[i]);
    validUltra[7]=prefixSum;validUltra[8]=0xA5;seal(validUltra);
    assert(validHandshakeReply(validUltra.data(),9));
    assert(validHandshakeReply(validUltra.data(),41));
    assert(normalizeHandshake(validUltra.data(),validUltra.size())==41);
  }
  {
    auto full=handshake("10.3",2,120,"REDLEO ULTRA PRO1");
    std::vector<uint8_t> noise={0x5A,0x00,0x01,0x5A,0x99};
    noise.insert(noise.end(),full.begin(),full.end());
    noise.insert(noise.end(),{0xAB,0xCD,0xE5});
    assert(normalizeHandshake(noise.data(),noise.size())==120);
    assert(std::memcmp(noise.data(),full.data(),120)==0);
    noise=full;noise.back()^=0x80;
    assert(normalizeHandshake(noise.data(),noise.size())==0);
  }
  {
    auto ultra=handshake("10.3",2,41,"REDLEO ULTRA PRO1");
    // A good UART reply may be raw-bridge valid even if the autonomous
    // guard profile is not. Guard's strict map/family checks stay intact.
    ultra[33]=0xFF;seal(ultra);
    assert(validHandshakeReply(ultra.data(),ultra.size()));
    assert(!parseHandshake(ultra.data(),ultra.size(),parsed));
  }
  // CRC-valid 0x5A must NEVER excuse a corrupt/unprintable ECU identity.
  auto invalidId=handshake("10.3",2);
  invalidId[7]=0x10;seal(invalidId);
  assert(!parseHandshake(invalidId.data(),invalidId.size(),parsed));
  // UART adapters can prepend echo/noise and append trailing bytes.
  auto cleanHs=handshake("9.13",3,41);
  std::vector<uint8_t> noisyHs={0xDE,0xAD};
  noisyHs.insert(noisyHs.end(),cleanHs.begin(),cleanHs.end());
  noisyHs.push_back(0x77);
  assert(normalizeHandshake(noisyHs.data(),noisyHs.size())==41);
  assert(std::memcmp(noisyHs.data(),cleanHs.data(),41)==0);
  auto cleanLive=live(8000);
  std::vector<uint8_t> noisyLive={0x99,0x88,0x77};
  noisyLive.insert(noisyLive.end(),cleanLive.begin(),cleanLive.end());
  noisyLive.push_back(0x22);
  assert(normalizeLive(noisyLive.data(),noisyLive.size())==53);
  assert(std::memcmp(noisyLive.data(),cleanLive.data(),53)==0);
  auto corruptOnly=handshake("9.13",3);
  corruptOnly[20]^=1;
  assert(normalizeHandshake(corruptOnly.data(),corruptOnly.size())==0);

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
  // Family minimum writable 0x9A page6 layouts. Wrong-family data is
  // rejected even when the checksum and physical UART pin are valid. Family always comes from 0x5A.
  struct Layout {Family fam;size_t size;size_t off;};
  for(const Layout &layout : {
       Layout{V91,33,5},Layout{V92,65,5},Layout{V92,66,5},
       Layout{V10,21,5},Layout{V10,22,5},
       Layout{ULTRA1,45,7},Layout{ULTRA1,46,7}}){
    for(uint8_t pg:{uint8_t(0x62),uint8_t(0x64),uint8_t(0x66),uint8_t(0x68)}){
      auto frame=limitPage(pg,9000,layout.size,layout.off);
      uint16_t got=0;
      assert(parseLimitForFamily(frame.data(),frame.size(),pg,layout.fam,got));
      assert(got==9000);
      // The handshake decides the ECU family; no family is inferred from
      // reply length. An 18B V10 page cannot satisfy the 30B V9.1 minimum,
      // and a 30B V9.1 page cannot satisfy the 42B Ultra minimum.
      assert(!parseLimitForFamily(frame.data(),frame.size(),pg,NONE,got));
      if(layout.size<33)assert(!parseLimitForFamily(frame.data(),frame.size(),pg,V91,got));
      if(layout.size<45)assert(!parseLimitForFamily(frame.data(),frame.size(),pg,ULTRA1,got));
      if(layout.size<65)assert(!parseLimitForFamily(frame.data(),frame.size(),pg,V92,got));
      assert(!parseLimitForFamily(frame.data(),frame.size(),
             uint8_t(pg^2),layout.fam,got));
      frame[layout.off]^=1;
      assert(!parseLimitForFamily(frame.data(),frame.size(),pg,layout.fam,got));
    }
  }
  // User-confirmed 9.13 Blink Idle/ECT Motor direct READ succeeds even if
  // ECU appends reply-only tail data beyond its 30B writable prefix.
  // These are synthetic checksums; verify actual ECU payload separately.
  for(const Layout &layout : {
       Layout{V91,34,5},Layout{V91,35,5},Layout{V91,41,5},
       Layout{V91,51,5},Layout{V92,67,5},Layout{V92,79,5},
       Layout{V10,23,5},Layout{V10,34,5},
       Layout{ULTRA1,47,7},Layout{ULTRA1,60,7}}){
    for(uint8_t pg:{uint8_t(0x62),uint8_t(0x64),
                    uint8_t(0x66),uint8_t(0x68)}){
      auto frame=limitPage(pg,9200,layout.size,layout.off);
      uint16_t got=0;
      assert(parseLimitForFamily(frame.data(),frame.size(),pg,layout.fam,got));
      assert(got==9200);
      // Read-only extra bytes do not justify ignoring a broken checksum.
      frame[layout.size-2]^=1;
      assert(!parseLimitForFamily(frame.data(),frame.size(),pg,layout.fam,got));
    }
  }
  // Refuse undersized but otherwise checksum-valid pages (no accidental
  // acceptance of truncated ECU memory as a valid RPM threshold).
  for(const Layout &layout : {
      Layout{V91,32,5},Layout{V92,64,5},
      Layout{V10,20,5},Layout{ULTRA1,44,7}}){
    auto frame=limitPage(0x62,8500,layout.size,layout.off);
    assert(!parseLimitForFamily(frame.data(),frame.size(),0x62,layout.fam,rpm));
  }
  // The same fully valid wire frame may be preceded or followed by serial
  // echo/status noise; only the checksum-protected page body is trusted.
  auto variable=limitPage(0x62,9350,37);
  std::vector<uint8_t> padded={0x01,0x62,0x12,0xAB};
  padded.insert(padded.end(),variable.begin(),variable.end());
  padded.insert(padded.end(),{0x12,0x34,0x56,0x78});
  assert(parseLimitForFamily(padded.data(),padded.size(),0x62,V91,rpm)&&rpm==9350);

  // Ultra parser must never mistake an index2 word for index3 maxSpeed.
  auto ultraWrong=limitPage(0x68,10000,45,5);
  assert(!parseLimitForFamily(ultraWrong.data(),ultraWrong.size(),0x68,ULTRA1,rpm));
  auto noisy=limitPage(0x68,8000,21);
  std::vector<uint8_t> withEcho={0xAA,0xCC};
  withEcho.insert(withEcho.end(),noisy.begin(),noisy.end());
  assert(parseLimitForFamily(withEcho.data(),withEcho.size(),0x68,V10,rpm)&&rpm==8000);
  for(const auto badLimit:{uint16_t(0),uint16_t(2500),uint16_t(18001)}){
    auto frame=limitPage(0x62,badLimit,21);
    assert(!parseLimitForFamily(frame.data(),frame.size(),0x62,V10,rpm));
  }
  auto unknown=limitPage(0x62,9000,46,7);
  assert(!parseLimitForFamily(unknown.data(),unknown.size(),0x62,NONE,rpm));

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

  // FW2.5 key-on arming proof: NEVER infer an RPM=0 from missing ECU data.
  BlinkGuardArm::Proof zero{};
  assert(!zero.ready(5000)); // ignition ON + no real Live frames
  zero.observe(100,0);
  zero.observe(350,0);
  zero.observe(600,0);
  zero.observe(850,0);
  assert(!zero.ready(850));  // <1s
  zero.observe(1100,0);
  assert(zero.ready(1100));  // 1s and >=3 checksum-valid 0-RPM samples
  assert(!zero.ready(1801)); // stale packet
  zero.reset();
  zero.observe(100,0);
  zero.observe(250,0);
  zero.observe(1000,0); // missing >700ms resets sequence
  zero.observe(1150,0);
  assert(!zero.ready(1150));
  zero.reset();
  zero.observe(50,0);
  zero.observe(300,0);
  zero.observe(350,1); // even a low nonzero RPM fails closed
  zero.observe(750,0);
  zero.observe(1000,0);
  zero.observe(1350,0);
  zero.observe(1600,0);
  assert(zero.sawMotion && !zero.ready(1600));
  zero.reset();
  zero.observe(0xFFFFFF00U,0);
  zero.observe(0xFFFFFFC8U,0);
  zero.observe(0x00000090U,0);
  zero.observe(0x000002E8U,0); // now-first = 1000ms across millis rollover
  assert(zero.ready(0x000002E8U));
  assert(BlinkGuardArm::PROOF_MS==1000U);
  assert(BlinkGuardArm::TIMEOUT_MS==30000U);

  std::cout << "PASS: firmware one-file cores; RX22/23 and RX26/33; handshake/live checksum;\n"
            << "      verified V9/V10.3/Ultra page6 and unsupported fail-closed; 5000ms timer\n";
}
