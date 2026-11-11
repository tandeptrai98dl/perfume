import { InfoPage, infoPageMetadata } from '../_content/info-page';

export function generateMetadata({ params }: PageProps<'/[locale]/about'>) {
  return infoPageMetadata('about', params);
}

export default function Page({ params }: PageProps<'/[locale]/about'>) {
  return <InfoPage pageKey="about" params={params} />;
}
