/* Independently authored boundary probe; never part of the worker runtime. */
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <unistd.h>
int main(void) {
  struct rlimit memory,cpu,files,core;
  getrlimit(RLIMIT_AS,&memory);getrlimit(RLIMIT_CPU,&cpu);
  getrlimit(RLIMIT_NOFILE,&files);getrlimit(RLIMIT_CORE,&core);
  if(open("/etc/passwd",O_RDONLY)!=-1||errno!=EPERM) return 1;
  if(socket(AF_INET,SOCK_STREAM,0)!=-1||errno!=EPERM) return 2;
  if(fork()!=-1||errno!=EPERM) return 3;
  if(memory.rlim_max!=1024UL*1024*1024||cpu.rlim_max!=20||files.rlim_max!=32||core.rlim_max!=0) return 4;
  puts("FILES_NETWORK_PROCESSES_DENIED_RESOURCE_LIMITS_SET");
  return 0;
}
