// Every profile effect. To add one: write a component taking { seed, w, h, avoid }
// (seed = artist name, w/h = panel size in px, avoid = { x1, x2 } span of the
// avatar/name/handle to keep hanging things off) and list it here. The pickers in
// Settings and on the artist page read this list.
import Celestial from "./Celestial";

export const EFFECTS = [
  { id: "celestial", name: "Celestial", hint: "Silk strings, hanging moons, twinkling stars", Component: Celestial },
];

export const effectById = id => EFFECTS.find(e => e.id === id);
