import { type LicensedAudioTrackDto } from "@love-memory/contracts";
import { type LicensedAudioCatalog, type LicensedAudioTrack } from "@love-memory/domain";

/** Same-origin static directory that serves catalog files (`apps/web/public/audio-library`). */
export const AUDIO_LIBRARY_PATH = "/audio-library";

export type AudioCatalogService = Readonly<{
  /** The browser DTO of an `active` track, or `null` for an unknown or withdrawn id. */
  findSelectableTrack: (id: string) => LicensedAudioTrackDto | null;
  isSelectableTrack: (id: string) => boolean;
  listSelectableTracks: () => readonly LicensedAudioTrackDto[];
}>;

function toDto(track: LicensedAudioTrack): LicensedAudioTrackDto {
  return {
    artist: track.artist,
    durationSec: track.durationSec,
    id: track.id,
    title: track.title,
    url: `${AUDIO_LIBRARY_PATH}/${track.file.fileName}`,
  };
}

export function createAudioCatalogService(catalog: LicensedAudioCatalog): AudioCatalogService {
  const selectable = Object.freeze(catalog.listSelectable().map(toDto));

  return Object.freeze({
    findSelectableTrack: (id: string) => selectable.find((track) => track.id === id) ?? null,
    isSelectableTrack: (id: string) => catalog.find(id)?.status === "active",
    listSelectableTracks: () => selectable,
  });
}
