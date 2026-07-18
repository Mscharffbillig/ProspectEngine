"use client";

import { useActionState, useState } from "react";
import { signInAction, signUpAction } from "@/lib/actions/auth";

export default function SignInPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signInState, signIn, signInPending] = useActionState(signInAction, null);
  const [signUpState, signUp, signUpPending] = useActionState(signUpAction, null);

  const pending = signInPending || signUpPending;
  const error = mode === "signin" ? signInState?.error : signUpState?.error;

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-4 text-xl font-semibold">
        {mode === "signin" ? "Sign in" : "Create account"}
      </h1>
      <form action={mode === "signin" ? signIn : signUp} className="card space-y-3">
        {mode === "signup" && (
          <div>
            <label htmlFor="name" className="label">
              Name
            </label>
            <input id="name" name="name" autoComplete="name" className="field" />
          </div>
        )}
        <div>
          <label htmlFor="email" className="label">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="field"
          />
        </div>
        <div>
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className="field"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn-primary w-full justify-center">
          {pending ? "Working…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="mt-3 text-sm text-blue-600 hover:underline"
      >
        {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
      </button>
    </div>
  );
}
