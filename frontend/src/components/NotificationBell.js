import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Bell, CheckCheck } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const NotificationBell = () => {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchNotifications = async () => {
    try {
      const { data } = await axios.get(`${API}/notifications`, { withCredentials: true });
      setNotifications(data);
    } catch (error) {
      // Ignore errors for unauthenticated states
    }
  };

  const markAllRead = async () => {
    try {
      await axios.post(`${API}/notifications/mark-all-read`, {}, { withCredentials: true });
      fetchNotifications();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const markRead = async (notifId) => {
    try {
      await axios.patch(`${API}/notifications/${notifId}/read`, {}, { withCredentials: true });
      fetchNotifications();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        data-testid="notification-bell"
        className="relative p-2 text-text-secondary hover:text-text-primary hover:bg-background rounded-lg transition-all duration-200"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span data-testid="notification-count" className="absolute top-0 right-0 bg-primary text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div data-testid="notification-dropdown" className="absolute right-0 mt-2 w-80 bg-card border border-border-light rounded-xl shadow-lg overflow-hidden z-50">
          <div className="flex justify-between items-center p-4 border-b border-border-light">
            <h3 className="font-heading font-medium text-text-primary">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                data-testid="mark-all-read-btn"
                className="text-xs text-primary hover:text-primary-hover flex items-center space-x-1"
              >
                <CheckCheck className="h-3 w-3" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p data-testid="no-notifications" className="text-text-secondary text-center py-8 text-sm">No notifications yet</p>
            ) : (
              notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => markRead(notif.id)}
                  data-testid={`notification-${notif.id}`}
                  className={`w-full text-left p-4 border-b border-border-light hover:bg-background transition-all duration-200 ${
                    !notif.read ? 'bg-primary-light/30' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-text-primary text-sm">{notif.title}</p>
                      <p className="text-text-secondary text-xs mt-1">{notif.message}</p>
                      <p className="text-text-muted text-xs mt-2">
                        {new Date(notif.created_at).toLocaleString('en-IN', {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                    </div>
                    {!notif.read && <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-2"></span>}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
