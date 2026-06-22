// The ONE canonical slug rule, reused everywhere a surface name becomes a screen id.
// "Project detail" -> "project-detail"; "Today / Home" -> "today-home".

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s/]+/g, '-') // spaces and "/" collapse to a single "-"
    .replace(/[^a-z0-9-]+/g, '') // keep only alnum + "-"
    .replace(/-+/g, '-') // collapse repeated "-"
    .replace(/^-|-$/g, ''); // trim leading/trailing "-"
}
