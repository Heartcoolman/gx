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
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <main style={{ flex: 1, position: 'relative' }}>
          <CampusMap />
        </main>
      </div>
      <BottomPanel />
    </div>
  );
}
