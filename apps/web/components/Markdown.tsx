import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FieldNoteParagraph } from "@/components/FieldNoteParagraph";
import { extractParagraphText, hashParagraph } from "@/lib/fieldNotes";

/** Passed only from the chronicle reader (Field Notes, Idea 3) -- every
 * other Markdown caller (archive documents, onyx_commentary) omits this
 * and gets the plain, unmarkable paragraph rendering, unchanged. */
export type FieldNotesConfig = {
  chronicleEntryId: string;
  markedHashes: ReadonlySet<string>;
  isSignedIn: boolean;
};

// Renders trusted, admin-authored body_markdown (chronicle entries, world
// briefings, archive documents). This is never end-user input, so the usual
// markdown-injection concerns don't apply -- react-markdown still doesn't
// render raw HTML by default, which is a reasonable extra guard regardless.
//
// Custom element renderers map to the Visual Direction type scale/tokens
// instead of pulling in the Tailwind typography plugin, so headings/links
// inside prose stay on the same design-token system as the rest of the app.
export function Markdown({
  children,
  fieldNotes,
}: {
  children: string;
  fieldNotes?: FieldNotesConfig;
}) {
  // Captured in this render's closure and incremented once per paragraph
  // in document order -- react-markdown invokes the `p` renderer
  // synchronously as it walks the tree, so this is a safe, simple stand-in
  // for a real paragraph index without needing external state.
  let paragraphIndex = 0;

  return (
    <div className="font-body text-body text-text-primary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => (
            <h2 className="mt-xl font-display text-section-heading text-text-primary" {...props} />
          ),
          h2: (props) => (
            <h3 className="mt-lg font-display text-card-title text-text-primary" {...props} />
          ),
          h3: (props) => (
            <h4 className="mt-md font-display text-card-title text-text-primary" {...props} />
          ),
          p: (props) => {
            if (!fieldNotes) {
              return <p className="mt-md leading-relaxed" {...props} />;
            }
            const index = paragraphIndex++;
            const text = extractParagraphText(props.children);
            const hash = hashParagraph(text);
            return (
              <FieldNoteParagraph
                chronicleEntryId={fieldNotes.chronicleEntryId}
                paragraphIndex={index}
                paragraphHash={hash}
                paragraphText={text}
                initiallyMarked={fieldNotes.markedHashes.has(hash)}
                isSignedIn={fieldNotes.isSignedIn}
              >
                {props.children}
              </FieldNoteParagraph>
            );
          },
          a: (props) => (
            <a className="text-accent-gold underline underline-offset-2" {...props} />
          ),
          ul: (props) => <ul className="mt-md list-disc space-y-xs pl-lg" {...props} />,
          ol: (props) => <ol className="mt-md list-decimal space-y-xs pl-lg" {...props} />,
          blockquote: (props) => (
            <blockquote
              className="mt-md border-l-2 border-accent-steel pl-md italic text-accent-steel"
              {...props}
            />
          ),
          hr: () => <hr className="my-lg border-border-subtle" />,
          code: (props) => (
            <code className="rounded bg-bg-hover px-1 font-mono text-body-small" {...props} />
          ),
          em: (props) => <em className="italic text-accent-steel" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
