import { signIn, signOut } from "@/auth";
import { Button } from "@/components/ui";

interface SignInButtonProps {
  disabled?: boolean;
}

export function SignInButton({ disabled = false }: SignInButtonProps) {
  if (disabled) {
    return <Button type="button" disabled>Google OAuth not configured</Button>;
  }

  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo: "/" });
      }}
    >
      <Button type="submit">Sign in with Google</Button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <Button type="submit" className="bg-slate-900 hover:bg-slate-800">
        Sign out
      </Button>
    </form>
  );
}
