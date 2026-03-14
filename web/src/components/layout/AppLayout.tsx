import Header from './Header';
import Sidebar from './Sidebar';
import BottomPanel from './BottomPanel';
import CampusMap from '../map/CampusMap';

export default function AppLayout() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
    }}>
      <Header />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative', zIndex: 1 }}>
        <Sidebar />
        <main style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <CampusMap />
          </div>
          <BottomPanel />
        </main>
      </div>
    </div>
  );
}
