"use server";

import { redirect } from "next/navigation";
import { neonAuth } from "@/lib/auth/server";

export interface AuthFormState {
  error: string;
}

export async function signInAction(
  _prev: AuthFormState | null,
  formData: FormData,
): Promise<AuthFormState | null> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const { error } = await neonAuth().signIn.email({ email, password });
  if (error) return { error: error.message ?? "Sign-in failed" };
  redirect("/");
}

export async function signUpAction(
  _prev: AuthFormState | null,
  formData: FormData,
): Promise<AuthFormState | null> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "") || email.split("@")[0] || "Owner";
  const { error } = await neonAuth().signUp.email({ email, password, name });
  if (error) return { error: error.message ?? "Sign-up failed" };
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await neonAuth().signOut();
  redirect("/auth/sign-in");
}
