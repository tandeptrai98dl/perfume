import { InfoPage, infoPageMetadata } from '../_content/info-page';

export function generateMetadata({ params }: PageProps<'/[locale]/contact'>) {
  return infoPageMetadata('contact', params);
}

export default function Page({ params }: PageProps<'/[locale]/contact'>) {
  return <InfoPage pageKey="contact" params={params} />;
}
