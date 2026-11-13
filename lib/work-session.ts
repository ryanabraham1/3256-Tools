import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { WORK_COOKIE_OPTIONS } from "./work-cookie";
export async function refreshWorkSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: WORK_COOKIE_OPTIONS,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          for (const c of cookies) request.cookies.set(c.name, c.value);
          response = NextResponse.next({ request });
          for (const c of cookies)
            response.cookies.set(c.name, c.value, {
              ...c.options,
              // @supabase/ssr overrides cookieOptions.maxAge with its 400-day default.
              maxAge: c.options.maxAge === 0 ? 0 : WORK_COOKIE_OPTIONS.maxAge,
            });
        },
      },
    },
  );
  const { data, error } = await client.auth.getClaims();
  const { pathname } = request.nextUrl;
  // Log routes check upload-only device tokens or Google account access themselves.
  // Still refresh browser sessions here so log browsing keeps users signed in.
  const routeHandlesAuth = pathname === "/api/robot-logs" || pathname.startsWith("/api/robot-logs/");
  // The tech binder (page and its CAD model) is public.
  const isPublic = pathname === "/binder" || pathname.startsWith("/binder/");
  if (
    (!data?.claims || error) &&
    !routeHandlesAuth &&
    !isPublic &&
    request.nextUrl.pathname !== "/login" &&
    request.nextUrl.pathname !== "/work/login" &&
    !request.nextUrl.pathname.startsWith("/auth/work/")
  ) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      for (const c of response.cookies.getAll()) unauthorized.cookies.set(c.name, c.value, c);
      unauthorized.headers.set("Cache-Control", "private, no-store");
      return unauthorized;
    }
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    const redirect = NextResponse.redirect(url);
    for (const c of response.cookies.getAll())
      redirect.cookies.set(c.name, c.value, c);
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
