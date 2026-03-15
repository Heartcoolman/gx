import Header from './Header';
import Sidebar from './Sidebar';
import BottomPanel from './BottomPanel';
import CampusMap from '../map/CampusMap';

export default function AppLayout() {
  return (
    <div className="app-root">
      <Header />
      <div className="app-body">
        <Sidebar />
        <main className="app-main">
          <div className="app-map-area">
            <CampusMap />
          </div>
          <BottomPanel />
        </main>
      </div>
    </div>
  );
}
