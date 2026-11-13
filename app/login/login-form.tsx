export function LoginForm({ next }: { next: string }) {
  return (
    <form action="/auth/work/sign-in" method="post" className="sheet-cell is-wide is-action">
      <input type="hidden" name="next" value={next} />
      <button type="submit" className="sheet-signin">
        <span>Sign in with Google</span>
        <span aria-hidden>→</span>
      </button>
    </form>
  );
}
