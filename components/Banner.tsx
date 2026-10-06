import { FileText, Globe2, Newspaper, PlaySquare } from "lucide-react";

const features = [
  { icon: Globe2, text: "تغطية\nشاملة" },
  { icon: Newspaper, text: "أخبار\nحصرية" },
  { icon: PlaySquare, text: "ملفات\nخاصة" },
  { icon: FileText, text: "تقارير\nموسعة" },
];

export default function Banner() {
  return (
    <section className="banner">
      <div className="banner-in">
        <div className="banner-text">
          <h2>قصص أعمق<br />من كل مكان في العالم</h2>
          <p><b>شُرفة</b> .. نافذتك إلى العالم وأخباره.</p>
          <hr />
        </div>
        <div className="feats">
          {features.map(({ icon: Icon, text }) => (
            <div key={text}>
              <Icon aria-hidden="true" />
              <span style={{ whiteSpace: "pre-line" }}>{text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
