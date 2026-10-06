export default function ArticleBody({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .map((b) => b.trim())
        .filter(Boolean)
        .map((b, i) => (b.startsWith("## ") ? <h2 key={i}>{b.slice(3)}</h2> : <p key={i}>{b}</p>))}
    </>
  );
}
