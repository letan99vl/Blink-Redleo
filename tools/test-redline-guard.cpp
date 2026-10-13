#include <cassert>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <vector>
#include "../firmware/redline_guard_core.h"

using namespace BlinkGuard;

static void seal(std::vector<uint8_t>& f){
  f[f.size()-1]=(uint8_t)(0xFFU-f[0]);
  uint8_t sum=0;
  for(size_t i=0;i<f.size()-2;i++)sum=(uint8_t)(sum+f[i]);
  f[f.size()-2]=sum;
}
static std::vector<uint8_t> handshake(const char *fw,unsigned map,int n){
  std::vector<uint8_t> f(n,0);
  f[0]=0x5A;
  memcpy(f.data()+1,"YAMAHA LC150    ",16);
  memcpy(f.data()+17,fw,4);
  f[33]=(uint8_t)(map-1);
  seal(f);
  return f;
}
static std::vector<uint8_t> limitPage(uint8_t page,uint16_t rpm,size_t n){
  std::vector<uint8_t> f(n,0);
  f[0]=page;
  f[5]=(uint8_t)(rpm>>8);
  f[6]=(uint8_t)(rpm&255);
  seal(f);
  return f;
}
int main(){
  uint8_t tx[5];
  request5(0x69,4,tx);
  assert(tx[0]==0x69&&tx[1]==4&&tx[4]==5);
  assert((uint8_t)(tx[0]+tx[1]+tx[2])==255);

  for(int n: {37,41}){
    auto f=handshake("9.13",2,n);
    Handshake v;
    assert(parseHandshake(f.data(),f.size(),v));
    assert(v.map==2&&strcmp(v.fw,"9.13")==0);
    f[18]^=1;
    assert(!parseHandshake(f.data(),f.size(),v));
  }
  auto old=handshake("10.2",1,41);
  Handshake v;
  assert(!parseHandshake(old.data(),old.size(),v));
  auto fw=handshake("9.30",1,41);
  assert(!parseHandshake(fw.data(),fw.size(),v));
  auto shortHs=std::vector<uint8_t>(9,0x5A);
  assert(!parseHandshake(shortHs.data(),shortHs.size(),v));

  uint16_t rpm=0;
  for (size_t size:{(size_t)33,(size_t)65,(size_t)66}){
    auto p=limitPage(0x62,12000,size);
    assert(parseLimit(p.data(),p.size(),0x62,rpm)&&rpm==12000);
    assert(!parseLimit(p.data(),p.size(),0x64,rpm));
    p[5]^=1;
    assert(!parseLimit(p.data(),p.size(),0x62,rpm));
  }
  for (int n:{100,2999,18001,65535}){
    auto p=limitPage(0x68,(uint16_t)n,33);
    assert(!parseLimit(p.data(),p.size(),0x68,rpm));
  }

  Window w;
  w.target(1,12000);
  assert(!w.observe(1000,11750));
  for(uint32_t t=1100;t<6000;t+=100){
    assert(!w.observe(t,11800));
  }
  assert(w.observe(6100,11800));
  assert(w.tripped);
  // Mapping change is the only path to a new active threshold.
  w.target(2,11000);
  assert(!w.tripped&&w.nearMs==0);
  assert(!w.observe(6200,10800));

  w.target(1,12000);
  w.observe(1000,12000);
  for(uint32_t t=1100;t<3500;t+=100)assert(!w.observe(t,11900));
  w.observe(3600,9000);
  w.observe(3700,9000);
  w.observe(3800,9000);
  w.observe(3900,9000);
  assert(w.nearMs==0);
  for(uint32_t t=4000;t<8500;t+=100)assert(!w.observe(t,11800));

  // Dropouts cannot quietly contribute to the 5-second accumulator.
  w.target(3,13500);
  w.observe(100,13500);
  w.observe(300,13500);
  w.stale(950);
  assert(w.nearMs==0);
  assert(!w.observe(1050,13500));
  assert(!w.observe(2050,13500));
  assert(w.nearMs==0);
  w.target(4,15000);
  for(uint32_t t=1000;t<8000;t+=100)assert(!w.observe(t,15000));
  std::cout<<"PASS: V9 9.13 only; checksum; page6 RPM; MAP4 excluded; exact 5s redline; dips/stale rejected\n";
}
