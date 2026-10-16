/* Linux decoder boundary: installed after dynamic linking, before codec entry.
 * Input/output are inherited pipes only. No new files, processes or sockets. */
#define _GNU_SOURCE
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sched.h>
#include <stddef.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <errno.h>
#define DENY(n) BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_##n, 0, 1), BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM)
static void limit(int kind, rlim_t value) {
  struct rlimit lim = { value, value };
  if (setrlimit(kind, &lim)) _exit(125);
}
__attribute__((constructor)) static void isolate(void) {
  limit(RLIMIT_AS, 1024UL*1024*1024);
  limit(RLIMIT_CPU, 20);
  limit(RLIMIT_FSIZE, 32UL*1024*1024);
  limit(RLIMIT_NOFILE, 32);
  limit(RLIMIT_NPROC, 256);
  limit(RLIMIT_CORE, 0);
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, arch)),
#if defined(__x86_64__)
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, AUDIT_ARCH_X86_64, 1, 0),
#elif defined(__aarch64__)
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, AUDIT_ARCH_AARCH64, 1, 0),
#else
#error Unsupported decoder architecture
#endif
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, nr)),
#if defined(__x86_64__)
    BPF_JUMP(BPF_JMP|BPF_JGE|BPF_K, 0x40000000, 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_KILL_PROCESS),
    DENY(open), DENY(creat), DENY(fork), DENY(vfork),
    DENY(unlink), DENY(rename), DENY(mkdir), DENY(rmdir), DENY(link), DENY(symlink),
    DENY(truncate), DENY(chmod), DENY(chown), DENY(lchown), DENY(mknod), DENY(utime), DENY(utimes),
#endif
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_clone, 0, 4),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K, CLONE_THREAD, 1, 0),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_clone3, 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|ENOSYS),
    DENY(pidfd_getfd), DENY(pidfd_send_signal), DENY(perf_event_open), DENY(userfaultfd),
    DENY(openat), DENY(openat2), DENY(open_by_handle_at),
    DENY(socket), DENY(socketpair), DENY(connect), DENY(bind), DENY(listen),
    DENY(accept), DENY(accept4), DENY(sendto), DENY(sendmsg), DENY(recvmsg),
    DENY(execve), DENY(execveat), DENY(ptrace), DENY(process_vm_readv), DENY(process_vm_writev),
    DENY(mount), DENY(umount2), DENY(unshare), DENY(setns), DENY(bpf), DENY(io_uring_setup),
    DENY(mknodat), DENY(fchmodat), DENY(fchownat), DENY(utimensat),
    DENY(setxattr), DENY(lsetxattr), DENY(removexattr), DENY(lremovexattr),
    DENY(unlinkat), DENY(renameat), DENY(renameat2), DENY(mkdirat), DENY(linkat), DENY(symlinkat),
    DENY(kill), DENY(tkill), DENY(tgkill),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW)
  };
  struct sock_fprog program = { sizeof(filter)/sizeof(filter[0]), filter };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) ||
      prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) _exit(125);
  if (write(2, "gif-sandbox-v1\n", 15) != 15) _exit(125);
}
