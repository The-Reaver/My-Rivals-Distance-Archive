/** Shared display-string helpers. No product logic lives here -- just
 * turning stored enum-ish values into reader-facing labels. */

export function titleCase(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

const BOOK_PLACEMENT_LABELS: Record<string, string> = {
  pre_book: "Pre-Book 1",
  book_1: "Book 1",
  book_2: "Book 2",
  book_3: "Book 3",
  book_4: "Book 4",
  book_5: "Book 5",
  post_series: "Post-Series",
};

export function bookPlacementLabel(bookPlacement: string): string {
  return BOOK_PLACEMENT_LABELS[bookPlacement] ?? titleCase(bookPlacement);
}
