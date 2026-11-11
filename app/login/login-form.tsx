export function LoginForm({ next }: { next: string }) {
  return (
    <form action="/auth/work/sign-in" method="post" className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <p className="text-sm" style={{ color: "var(--plum-text)" }}>
        Use the Google account your team admin has added. One sign-in opens all team tools.
      </p>
      <button type="submit" className="btn btn-plum text-base py-4 mt-2">
        Continue with Google <span aria-hidden>→</span>
      </button>
      <p className="text-sm" style={{ color: "var(--plum-text)" }}>Stay signed in on this device for up to 30 days, renewed as you use the app.</p>
    </form>
  );
}
