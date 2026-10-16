import { createContext, useContext } from 'react';
import type { TablePerson } from '../protocol/index.ts';

export const AuthorColours = createContext<readonly TablePerson[]>([]);

export function useAuthorColour(who: string): number | undefined {
  return useContext(AuthorColours).find((person) => person.id === who)?.colour;
}
