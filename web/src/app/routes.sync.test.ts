import { describe, expect, it } from 'vitest';
import { storyNameFromExport, toId } from 'storybook/internal/csf';
import { ROUTES } from './routes';
import * as prototype from './Prototype.stories';

/**
 * Keeps the prototype app and Storybook in sync:
 *  1. every manifest route has a Prototype story with the route's storyId and path;
 *  2. every Prototype story points at a route in the manifest;
 *  3. every manifest screen component has a stories file of its own (meta.component).
 */
type StoryModule = { default?: { title?: string; component?: unknown } } & Record<string, unknown>;
type StoryExport = { args?: { path?: string }; parameters?: { route?: string } };

const title = (prototype.default as { title: string }).title;
const prototypeStories = Object.entries(prototype)
  .filter(([name]) => name !== 'default' && name !== '__namedExportsOrder')
  .map(([name, s]) => ({ name, id: toId(title, storyNameFromExport(name)), route: (s as StoryExport).parameters?.route, path: (s as StoryExport).args?.path }));

describe('route manifest ↔ Prototype stories', () => {
  it('has a Prototype story for every route, with the same id and path', () => {
    for (const r of ROUTES) {
      const s = prototypeStories.find((p) => p.id === r.storyId);
      expect(s, `no Prototype story with id ${r.storyId} for ${r.path}`).toBeDefined();
      expect(s?.route, `story ${r.storyId} renders ${s?.route}, manifest says ${r.path}`).toBe(r.path);
      expect(s?.path).toBe(r.path);
    }
  });

  it('has no Prototype story for a route that is not in the manifest', () => {
    const paths = new Set(ROUTES.map((r) => r.path));
    const ids = new Set(ROUTES.map((r) => r.storyId));
    for (const s of prototypeStories) {
      expect(paths.has(s.route ?? ''), `Prototype story ${s.name} points at ${s.route}, not in routes.ts`).toBe(true);
      expect(ids.has(s.id), `Prototype story id ${s.id} is not a manifest storyId`).toBe(true);
    }
  });

  it('gives every manifest screen component a stories file', () => {
    const modules = import.meta.glob<StoryModule>('../**/*.stories.tsx', { eager: true });
    const covered = new Set(Object.values(modules).map((m) => m.default?.component).filter(Boolean));
    for (const r of ROUTES) {
      const name = (r.component as { name?: string }).name ?? r.path;
      expect(covered.has(r.component), `${name} (${r.path}) has no .stories.tsx with meta.component = ${name}`).toBe(true);
    }
  });

  it('uses unique paths and story ids', () => {
    expect(new Set(ROUTES.map((r) => r.path)).size).toBe(ROUTES.length);
    expect(new Set(ROUTES.map((r) => r.storyId)).size).toBe(ROUTES.length);
  });
});
