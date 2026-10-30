// @types/react-dom is not a dependency of this repo; declare only what the UI primitives use.
declare module 'react-dom' {
  import type { ReactNode } from 'react';
  export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactNode;
}
