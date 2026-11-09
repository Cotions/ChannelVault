/* "Play parts" plays the tagged parts. Videos tagged as a whole (one item
   each, often hours long) only play when the tag marks no parts at all; they
   stay a click away in the grid. */
export function playableItems(items = []) {
  const parts = items.filter(i => i.segment_id != null);
  return parts.length ? parts : items;
}
