import { getDb } from '@/server/db/client';
import { listMediaOptions, listProductOptions, listTopicsForAdmin } from '@/server/modules/content';

/** Pickers for the post editor: media, topics (Vietnamese names) and products. */
export async function postFormOptions() {
  const db = getDb();
  const [media, topics, products] = await Promise.all([
    listMediaOptions(db),
    listTopicsForAdmin(db),
    listProductOptions(db),
  ]);
  return {
    media: media.map((m) => ({ id: m.id, url: m.url, alt: m.alt })),
    topics: topics.map((topic) => ({
      id: topic.id,
      name: topic.vi?.title ?? topic.en?.title ?? topic.id,
    })),
    products,
  };
}
