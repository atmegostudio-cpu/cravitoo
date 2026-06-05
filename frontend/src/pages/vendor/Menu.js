import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '../../components/Navbar';
import { Leaf, ImageIcon, Lock, MessageSquare, Camera, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const PhotoAuditCard = ({ items, onRequestPhoto }) => {
  const [expanded, setExpanded] = useState(false);
  const missing = useMemo(() => items.filter((it) => !it.image_url), [items]);
  if (items.length === 0) return null;
  const coveragePct = Math.round(((items.length - missing.length) * 100) / items.length);
  const allCovered = missing.length === 0;
  return (
    <div data-testid="photo-audit-card" className={`mb-6 p-5 rounded-2xl border ${allCovered ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'} `}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`rounded-full p-2 flex-shrink-0 ${allCovered ? 'bg-emerald-600' : 'bg-amber-500'} text-white`}>
            {allCovered ? <Camera className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-heading text-lg font-semibold text-text-primary">Photo audit</h3>
            <p className="text-sm text-text-secondary mt-1">
              <strong>{items.length - missing.length} of {items.length}</strong> items have a photo
              {' • '}
              <strong className={allCovered ? 'text-emerald-700' : 'text-amber-700'}>{coveragePct}% coverage</strong>
              {!allCovered && (
                <>
                  {' '}— <strong>{missing.length} item{missing.length > 1 ? 's' : ''}</strong> still need{missing.length === 1 ? 's' : ''} one.
                </>
              )}
            </p>
            {!allCovered && (
              <p className="text-xs text-text-muted mt-2">
                Items without photos get fewer orders. Request a photo and Cravitoo will add one (you can attach your own or we'll generate a professional shot).
              </p>
            )}
          </div>
        </div>
        {!allCovered && (
          <button
            data-testid="audit-toggle"
            onClick={() => setExpanded((x) => !x)}
            className="text-sm text-amber-700 hover:text-amber-900 font-medium flex items-center gap-1 flex-shrink-0"
          >
            {expanded ? 'Hide list' : 'Show list'}
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Coverage bar */}
      <div className="mt-4">
        <div className="h-2 w-full bg-white rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${allCovered ? 'bg-emerald-600' : 'bg-amber-500'}`}
            style={{ width: `${coveragePct}%` }}
          />
        </div>
      </div>

      {expanded && !allCovered && (
        <ul data-testid="audit-missing-list" className="mt-4 divide-y divide-amber-200/60 bg-white/60 rounded-lg overflow-hidden">
          {missing.map((it) => (
            <li key={it.id} data-testid={`audit-item-${it.id}`} className="px-4 py-3 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{it.name}</p>
                <p className="text-xs text-text-muted">{it.category} • ₹{(it.price || 0).toFixed(2)}</p>
              </div>
              <button
                data-testid={`request-photo-${it.id}`}
                onClick={() => onRequestPhoto(it)}
                className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 flex items-center gap-1.5 flex-shrink-0"
              >
                <Camera className="h-3.5 w-3.5" /> Request photo
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const VendorMenu = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchMenu();
  }, []);

  const fetchMenu = async () => {
    try {
      const { data } = await axios.get(`${API}/menu/vendor/all`, { withCredentials: true });
      setItems(data);
    } catch (error) {
      console.error('Error fetching menu:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestPhoto = (item) => {
    // Navigate to the existing Menu Change Request flow with a prefill so the
    // vendor lands on a request pre-filled for THIS item, ready to attach a photo.
    navigate('/vendor/menu-requests', {
      state: {
        prefill: {
          request_type: 'edit',
          target_item_id: item.id,
          name: item.name,
          description: item.description || '',
          category: item.category,
          price: item.price,
          is_vegetarian: !!item.is_vegetarian,
          reason: `Please add a photo for "${item.name}".`,
          focus: 'photo',
        },
      },
    });
  };

  const toggleAvailability = async (item) => {
    // Optimistic update
    setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, is_available: !x.is_available } : x));
    try {
      await axios.patch(`${API}/menu/${item.id}/availability`, {}, { withCredentials: true });
      setMessage(item.is_available ? `Marked "${item.name}" out of stock` : `Marked "${item.name}" available`);
      setTimeout(() => setMessage(''), 2500);
    } catch (e) {
      // Revert on failure
      setItems((prev) => prev.map((x) => x.id === item.id ? { ...x, is_available: item.is_available } : x));
      setMessage(e.response?.data?.detail || 'Toggle failed');
    }
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="mb-6">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
              Menu
            </h1>
            <p className="text-text-secondary mt-2">View your menu and toggle items in/out of stock</p>
          </div>

          {/* Cravitoo-managed banner */}
          <div data-testid="cravitoo-managed-banner" className="mb-8 p-5 bg-primary-light border border-primary/20 rounded-2xl flex items-start space-x-4">
            <div className="bg-primary text-white rounded-full p-2 flex-shrink-0">
              <Lock className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h3 className="font-heading text-lg font-semibold text-text-primary mb-1">
                Menu &amp; pricing managed by Cravitoo
              </h3>
              <p className="text-sm text-text-secondary mb-2">
                Your menu items, descriptions, photos, and prices are centrally managed by the Cravitoo team
                to ensure quality and consistency across all sites. You can only mark items as <strong>In stock</strong> or
                <strong> Out of stock</strong> for day-to-day operations.
              </p>
              <Link
                to="/vendor/menu-requests"
                data-testid="contact-cravitoo-link"
                className="inline-flex items-center space-x-2 text-sm font-medium text-primary hover:underline"
              >
                <MessageSquare className="h-4 w-4" />
                <span>Request menu / pricing change</span>
              </Link>
            </div>
          </div>

          {message && (
            <div data-testid="menu-message" className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
              {message}
            </div>
          )}

          {/* Photo audit (only meaningful when there are items) */}
          {items.length > 0 && <PhotoAuditCard items={items} onRequestPhoto={handleRequestPhoto} />}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((item) => (
              <div key={item.id} data-testid={`vendor-menu-item-${item.id}`} className="bg-card border border-border-light rounded-xl overflow-hidden hover:shadow-md transition-all duration-200">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.name} className="w-full h-40 object-cover" />
                ) : (
                  <button
                    type="button"
                    data-testid={`card-request-photo-${item.id}`}
                    onClick={() => handleRequestPhoto(item)}
                    className="w-full h-40 bg-amber-50 border-b border-amber-200 flex flex-col items-center justify-center group hover:bg-amber-100 transition-colors"
                    title="Request a photo for this item"
                  >
                    <ImageIcon className="h-10 w-10 text-amber-500 group-hover:scale-110 transition-transform" />
                    <span className="mt-2 text-xs font-medium text-amber-700 flex items-center gap-1">
                      <Camera className="h-3 w-3" /> Request photo
                    </span>
                  </button>
                )}
                <div className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-heading text-lg font-medium text-text-primary">{item.name}</h3>
                    {item.is_vegetarian && <Leaf className="h-5 w-5 text-green-600" />}
                  </div>
                  <p className="text-text-secondary text-sm mb-3 line-clamp-2">{item.description}</p>
                  <div className="flex justify-between items-center mb-3">
                    <p className="font-semibold text-primary text-lg">₹{item.price.toFixed(2)}</p>
                    <span className="text-xs text-text-muted">{item.category}</span>
                  </div>
                  <button
                    onClick={() => toggleAvailability(item)}
                    data-testid={`toggle-availability-${item.id}`}
                    className={`w-full px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                      item.is_available
                        ? 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
                        : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                    }`}
                  >
                    {item.is_available ? '✓ In stock — tap to mark out' : '✕ Out of stock — tap to restock'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {items.length === 0 && (
            <div data-testid="no-items-state" className="bg-card border border-border-light rounded-xl p-12 text-center">
              <p className="text-text-secondary mb-2">No menu items yet</p>
              <p className="text-sm text-text-muted">
                Your menu will appear here once Cravitoo has loaded it. Contact your account manager to get started.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default VendorMenu;
