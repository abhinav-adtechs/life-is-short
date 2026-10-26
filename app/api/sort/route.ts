export async function POST() {
  return Response.json({ reason: 'no-key' }, { status: 503 });
}
