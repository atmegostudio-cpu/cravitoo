import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { CalendarDays, Users, Plus, CheckCircle, Clock, Send } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const EventCatering = () => {
  const [events, setEvents] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    vendor_id: '',
    event_name: '',
    event_date: '',
    headcount: 50,
    notes: '',
    menu_items: []
  });

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (formData.vendor_id) fetchMenu(formData.vendor_id);
  }, [formData.vendor_id]);

  const fetchData = async () => {
    try {
      const [eventsRes, vendorsRes] = await Promise.all([
        axios.get(`${API}/events`, { withCredentials: true }),
        axios.get(`${API}/vendors`, { withCredentials: true })
      ]);
      setEvents(eventsRes.data);
      setVendors(vendorsRes.data);
      if (vendorsRes.data.length > 0) {
        setFormData(f => ({ ...f, vendor_id: vendorsRes.data[0].id }));
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMenu = async (vendorId) => {
    try {
      const { data } = await axios.get(`${API}/menu/${vendorId}`, { withCredentials: true });
      setMenuItems(data);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const toggleMenuItem = (itemId) => {
    const existing = formData.menu_items.findIndex(i => i.menu_item_id === itemId);
    let newItems;
    if (existing >= 0) {
      newItems = formData.menu_items.filter((_, idx) => idx !== existing);
    } else {
      const item = menuItems.find(m => m.id === itemId);
      newItems = [...formData.menu_items, { menu_item_id: itemId, quantity: 1, price: item.price }];
    }
    setFormData({ ...formData, menu_items: newItems });
  };

  const updateItemQty = (itemId, qty) => {
    setFormData({
      ...formData,
      menu_items: formData.menu_items.map(i =>
        i.menu_item_id === itemId ? { ...i, quantity: Math.max(1, qty) } : i
      )
    });
  };

  const submitEvent = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/events`, formData, { withCredentials: true });
      setMessage('Event catering request submitted!');
      setShowForm(false);
      setFormData({ ...formData, event_name: '', event_date: '', headcount: 50, notes: '', menu_items: [] });
      fetchData();
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage(error.response?.data?.detail || 'Failed to submit event');
    }
  };

  const approveEvent = async (eventId) => {
    try {
      await axios.patch(`${API}/events/${eventId}/approve`, {}, { withCredentials: true });
      fetchData();
      setMessage('Event approved');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('Failed to approve');
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
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex justify-between items-center flex-wrap gap-4 mb-8">
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <CalendarDays className="h-8 w-8 text-primary" />
                <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
                  Event Catering
                </h1>
              </div>
              <p className="text-text-secondary text-lg">Plan and order food for events</p>
            </div>
            <button
              onClick={() => setShowForm(!showForm)}
              data-testid="new-event-btn"
              className="bg-primary hover:bg-primary-hover text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center space-x-2"
            >
              <Plus className="h-5 w-5" />
              <span>New Event</span>
            </button>
          </div>

          {message && (
            <div data-testid="event-message" className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
              {message}
            </div>
          )}

          {showForm && (
            <div data-testid="event-form" className="bg-card border border-border-light rounded-2xl p-6 mb-8">
              <h2 className="font-heading text-2xl font-medium text-text-primary mb-6">Create Event Catering Request</h2>
              <form onSubmit={submitEvent} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">Vendor</label>
                    <select
                      required
                      data-testid="event-vendor-select"
                      value={formData.vendor_id}
                      onChange={(e) => setFormData({...formData, vendor_id: e.target.value})}
                      className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                    >
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">Event Name</label>
                    <input
                      type="text"
                      required
                      data-testid="event-name-input"
                      value={formData.event_name}
                      onChange={(e) => setFormData({...formData, event_name: e.target.value})}
                      placeholder="Annual Conference 2026"
                      className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">Event Date</label>
                    <input
                      type="date"
                      required
                      data-testid="event-date-input"
                      value={formData.event_date}
                      onChange={(e) => setFormData({...formData, event_date: e.target.value})}
                      className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">Headcount</label>
                    <input
                      type="number"
                      required
                      min="1"
                      data-testid="event-headcount-input"
                      value={formData.headcount}
                      onChange={(e) => setFormData({...formData, headcount: parseInt(e.target.value)})}
                      className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Notes (optional)</label>
                  <textarea
                    data-testid="event-notes-input"
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    placeholder="Special dietary requirements, setup time, etc."
                    rows="2"
                    className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Select Menu Items (per person)</label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {menuItems.map((item) => {
                      const selected = formData.menu_items.find(i => i.menu_item_id === item.id);
                      return (
                        <div
                          key={item.id}
                          className={`border-2 rounded-lg p-3 transition-all duration-200 ${
                            selected ? 'border-primary bg-primary-light/50' : 'border-border-light bg-background'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleMenuItem(item.id)}
                            data-testid={`event-item-${item.id}`}
                            className="w-full text-left"
                          >
                            <p className="font-medium text-text-primary text-sm">{item.name}</p>
                            <p className="text-xs text-primary">₹{item.price.toFixed(2)} × {formData.headcount} = ₹{(item.price * formData.headcount).toFixed(2)}</p>
                          </button>
                          {selected && (
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-light">
                              <span className="text-text-secondary text-xs">Qty/person</span>
                              <input
                                type="number"
                                min="1"
                                value={selected.quantity}
                                onChange={(e) => updateItemQty(item.id, parseInt(e.target.value))}
                                className="w-16 px-2 py-1 border border-border-light rounded text-sm text-center"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="submit"
                  data-testid="submit-event-btn"
                  className="w-full bg-primary hover:bg-primary-hover text-white py-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center space-x-2"
                >
                  <Send className="h-5 w-5" />
                  <span>Submit Catering Request</span>
                </button>
              </form>
            </div>
          )}

          <h2 className="font-heading text-2xl font-medium text-text-primary mb-4">My Events</h2>
          {events.length === 0 ? (
            <div data-testid="no-events-state" className="bg-card border border-border-light rounded-xl p-12 text-center">
              <CalendarDays className="h-16 w-16 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary">No event catering requests yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {events.map((event) => (
                <div key={event.id} data-testid={`event-${event.id}`} className="bg-card border border-border-light rounded-xl p-6">
                  <div className="flex justify-between items-start flex-wrap gap-3 mb-4">
                    <div>
                      <h3 className="font-heading text-xl font-medium text-text-primary mb-1">{event.event_name}</h3>
                      <div className="flex items-center space-x-4 text-sm text-text-secondary">
                        <span className="flex items-center space-x-1">
                          <CalendarDays className="h-4 w-4" />
                          <span>{event.event_date}</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <Users className="h-4 w-4" />
                          <span>{event.headcount} people</span>
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-heading text-2xl font-semibold text-primary">₹{event.total_amount?.toFixed(2)}</p>
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium mt-1 ${
                        event.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {event.status === 'approved' ? (
                          <span className="flex items-center space-x-1">
                            <CheckCircle className="h-3 w-3" />
                            <span>Approved</span>
                          </span>
                        ) : (
                          <span className="flex items-center space-x-1">
                            <Clock className="h-3 w-3" />
                            <span>Pending Approval</span>
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                  {event.notes && <p className="text-text-secondary text-sm mb-3">Note: {event.notes}</p>}
                  {event.status === 'pending_approval' && (
                    <button
                      onClick={() => approveEvent(event.id)}
                      data-testid={`approve-event-${event.id}`}
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                    >
                      Approve Event
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default EventCatering;
