import { LogIn, LogOut } from "lucide-react";
import { signIn, signOut } from "@/auth";
import { Button } from "@/components/ui";

interface SignInButtonProps {
  disabled?: boolean;
}

export function SignInButton({ disabled = false }: SignInButtonProps) {
  if (disabled) {
    return <Button type="button" variant="secondary" size="sm" disabled>OAuth unavailable</Button>;
  }

  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo: "/" });
      }}
    >
      <Button type="submit" size="sm">
        <LogIn className="h-4 w-4" />
        <span className="hidden sm:inline">Sign in with Google</span>
        <span className="sm:hidden">Sign in</span>
      </Button>
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
      <Button type="submit" variant="secondary" size="sm">
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    </form>
  );
}
