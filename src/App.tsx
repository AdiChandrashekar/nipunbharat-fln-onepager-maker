import { useMemo } from "react";
import { createDocument, demoSelection } from "./doc/newDoc";
import { fitDocument } from "./layout/fit";
import type { Language, Orientation, PageSizeId } from "./model/types";
import { PageView } from "./render/PageView";
import { SamplesPreview } from "./samples/SamplesPreview";
import { Maker } from "./ui/Maker";

export function App() {
  const params = new URLSearchParams(location.search);
  if (params.get("samples")) return <SamplesPreview />;
  if (params.get("demo")) return <DemoRender params={params} />;
  return <Maker />;
}

/**
 * Bare render of a demo document, for scaling screenshots:
 * ?demo=24&template=competency-cards&size=A4&orient=landscape&lang=hi&tier=auto
 */
function DemoRender({ params }: { params: URLSearchParams }) {
  const fit = useMemo(() => {
    const doc = createDocument({
      selection: demoSelection(Number(params.get("demo")) as 2 | 8 | 24),
      template: params.get("template") ?? "competency-cards",
      size: (params.get("size") ?? "A4") as PageSizeId,
      orientation: (params.get("orient") ?? "portrait") as Orientation,
      language: (params.get("lang") ?? "hi") as Language,
    });
    const tier = params.get("tier");
    if (tier && tier !== "auto") doc.layout.tier = tier as typeof doc.layout.tier;
    const r = fitDocument(doc);
    document.title = `${r.tier} · ${r.pageCount}`;
    return { doc, r };
  }, []);
  return (
    <div className="bare" data-readout={`${fit.r.tier}.${fit.r.step} · ${fit.r.pageCount} pages · ${fit.r.cols} cols · dropped ${fit.r.dropped.join(",")}`}>
      {fit.r.pages.map((p) => (
        <PageView key={p.id} page={p} setup={fit.doc.page} />
      ))}
    </div>
  );
}
