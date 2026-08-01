import Landing from './landing/Landing';

// Runs during parse, before the landing paints, so a signed-in visitor is never
// shown the marketing page on their way to the portal.
const BOUNCE = `try{var t=localStorage.getItem('token');if(t){var o=JSON.parse(localStorage.getItem('org')||'{}');location.replace(o.type==='admin'?'/admin':'/dashboard')}}catch(e){}`;

export const metadata = {
  title: 'QR Reward Platform — pay for signups, not scans',
  description:
    'Print a QR code anywhere. Coins leave your campaign budget only after a partner publisher confirms a real signup — guest rate until they verify the user, full rate once they do.',
};

export default function Home() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: BOUNCE }} />
      <script
        dangerouslySetInnerHTML={{
          __html: `addEventListener('load',function(){setTimeout(function(){var w=innerWidth,out=['VP='+w+' DOC='+document.documentElement.scrollWidth];document.querySelectorAll('*').forEach(function(e){var r=e.getBoundingClientRect();if(r.right>w+1||r.left<-1)out.push(e.tagName+'.'+e.className+' L='+Math.round(r.left)+' R='+Math.round(r.right))});document.title=out.slice(0,14).join(' || ')},400)})`,
        }}
      />
      <Landing />
    </>
  );
}
