"use client";

import { useActionState } from "react";
import Logo from "@/components/Logo";
import { login } from "../actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <div className="login-wrap">
      <form action={action} className="login-card">
        <div className="login-logo">
          <Logo />
        </div>
        <h1>تسجيل الدخول إلى لوحة التحكم</h1>
        {state?.error && <div className="notice err">{state.error}</div>}
        <label>
          البريد الإلكتروني
          <input name="email" type="email" required autoComplete="username" dir="ltr" />
        </label>
        <label>
          كلمة المرور
          <input name="password" type="password" required maxLength={1024} autoComplete="current-password" dir="ltr" />
        </label>
        <button className="btn-primary" disabled={pending}>
          {pending ? "جارٍ الدخول..." : "دخول"}
        </button>
      </form>
    </div>
  );
}
