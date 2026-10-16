import Link from 'next/link';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main>
      <p className="eyebrow">GIF Platform</p>
      <h1>Sign in</h1>
      <LoginForm />
      <p>
        <Link href="/">Public home</Link>
      </p>
    </main>
  );
}
