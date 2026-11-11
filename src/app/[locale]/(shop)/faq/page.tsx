import { InfoPage, infoPageMetadata } from '../_content/info-page';

export function generateMetadata({ params }: PageProps<'/[locale]/faq'>) {
  return infoPageMetadata('faq', params);
}

export default function Page({ params }: PageProps<'/[locale]/faq'>) {
  return <InfoPage pageKey="faq" params={params} />;
}
