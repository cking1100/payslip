import PayslipDetail from "./PayslipDetail";

export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PayslipDetail id={id} />;
}
