import type { PublicGif } from './public.js';

/** A reference, never proof of delivery or permission for a later Host action. */
export type GifSelectionReference = Pick<
  PublicGif,
  'id' | 'title' | 'posterUrl' | 'displayUrl'
> & { kind: 'GIF' };

export type PickerResult =
  | { status: 'selected'; reference: GifSelectionReference }
  | { status: 'cancelled' };

export type PickerError = {
  code: 'SEARCH_UNAVAILABLE' | 'SELECTION_UNAVAILABLE' | 'GIF_RESTRICTED';
};

/** One terminal onSelect/onCancel per mounted open session; errors are recoverable. */
export interface PickerCallbacks {
  onSelect(reference: GifSelectionReference): void;
  onCancel(): void;
  onError(error: PickerError): void;
}
