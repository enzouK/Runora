import { Deck, DeckCounts } from '../types/runora';
import { StorageService } from './storage';

export interface DeckTreeNode {
  deck: Deck;
  shortName: string;
  fullName: string;
  level: number;
  children: DeckTreeNode[];
  counts: DeckCounts;
}

export class DeckService {
  /**
   * Builds a nested tree structure from flat deck names with "::" separators
   */
  public static buildDeckTree(decks: Deck[]): DeckTreeNode[] {
    const rootNodes: DeckTreeNode[] = [];
    const nodeMap = new Map<string, DeckTreeNode>();

    // Sort decks alphabetically
    const sortedDecks = [...decks].sort((a, b) => a.name.localeCompare(b.name));

    for (const deck of sortedDecks) {
      const parts = deck.name.split('::');
      const shortName = parts[parts.length - 1];
      const level = parts.length - 1;
      const counts = StorageService.getDeckCounts(deck.id);

      const node: DeckTreeNode = {
        deck,
        shortName,
        fullName: deck.name,
        level,
        children: [],
        counts,
      };

      nodeMap.set(deck.name, node);

      if (level === 0) {
        rootNodes.push(node);
      } else {
        const parentName = parts.slice(0, -1).join('::');
        const parentNode = nodeMap.get(parentName);
        if (parentNode) {
          parentNode.children.push(node);
        } else {
          // Orphaned subdeck fallback
          rootNodes.push(node);
        }
      }
    }

    return rootNodes;
  }

  /**
   * Helper to format breadcrumb parts from a deck name
   */
  public static getBreadcrumbs(deckName: string): string[] {
    return deckName.split('::');
  }
}
