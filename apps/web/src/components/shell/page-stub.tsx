export function PageStub({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-h3">{title}</h1>
      <p className="text-muted-foreground text-sm">Em breve.</p>
    </div>
  );
}
