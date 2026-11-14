interface PlaceholderPageProps {
  title: string;
}

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <>
      <h1>{title}</h1>
      <p className="empty">Dieser Bereich folgt in einer späteren Phase.</p>
    </>
  );
}
