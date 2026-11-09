import EscolaLandingClient from './portal-escola-client';

export const instant = false;

export default async function EscolaLandingPage({ params }) {
  const { subdomonio } = await params;
  return <EscolaLandingClient key={subdomonio} subdomonio={subdomonio} />;
}
