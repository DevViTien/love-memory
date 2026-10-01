import { licensedAudioCatalog } from "@love-memory/domain";

import { createAudioCatalogService } from "@/modules/audio/application/audio-catalog";

export const audioCatalog = createAudioCatalogService(licensedAudioCatalog);
