import { NextResponse } from 'next/server';

export function middleware(request) {
  const url = request.nextUrl;
  const hostname = request.headers.get('host') || ''; // ex: leopoldina.localhost:3000
  const currentHost = process.env.NODE_ENV === 'production'
    ? hostname.replace('.futurese.com', '')
    : hostname.replace('.localhost:3000', '').replace(':3000', '');

  // 1. Ignorar assets internos do Next.js, API e ficheiros estáticos
  if (
    hostname.includes('_next') ||
    hostname.includes('api') ||
    url.pathname.includes('.') ||
    url.pathname.startsWith('/favicon.ico')
  ) {
    return NextResponse.next();
  }

  if (url.pathname === '/auth' || url.pathname === '/auth/') {
    return NextResponse.redirect(new URL('/', request.url));
  }
  if (url.pathname === '/auth/selecionar' || url.pathname === '/auth/selecionar/') {
    return NextResponse.redirect(new URL('/selecionar', request.url));
  }

  // 2. Proteção de rotas privadas (/dashboard/*)
  if (url.pathname.startsWith('/dashboard')) {
    const session = request.cookies.get('session_token');
    if (!session?.value) {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  // 3. Gestão de Subdomínios para o Multi-Tenant (Landing Pages das Escolas)
  // Remove a porta (ex: :3000) e o domínio base para isolar apenas o subdomênio
  // Se existir um subdomínio válido (que não seja www, localhost ou o domínio principal vazio)
  if (
    currentHost &&
    currentHost !== 'www' &&
    currentHost !== 'futurese' &&
    currentHost !== 'localhost' &&
    !url.pathname.startsWith('/dashboard') &&
    !url.pathname.startsWith('/auth')
  ) {
    // Reescreve internamente para a pasta dinâmica [subdomain]
    return NextResponse.rewrite(new URL(`/${currentHost}${url.pathname}${url.search}`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};