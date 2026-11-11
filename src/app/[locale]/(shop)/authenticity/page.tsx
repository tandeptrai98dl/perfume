import { InfoPage, infoPageMetadata } from '../_content/info-page';

export function generateMetadata({ params }: PageProps<'/[locale]/authenticity'>) {
  return infoPageMetadata('authenticity', params);
}

export default function Page({ params }: PageProps<'/[locale]/authenticity'>) {
  return <InfoPage pageKey="authenticity" params={params} />;
}
