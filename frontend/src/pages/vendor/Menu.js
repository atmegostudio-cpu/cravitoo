import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Plus, Edit2, Trash2, X, Save, Leaf, ImageIcon } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const VendorMenu = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'Main Course',
    price: '',
    image_url: '',
    is_vegetarian: false,
    is_available: true
  });

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

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      category: 'Main Course',
      price: '',
      image_url: '',
      is_vegetarian: false,
      is_available: true
    });
    setEditingItem(null);
    setShowForm(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...formData, price: parseFloat(formData.price) };
      if (editingItem) {
        await axios.patch(`${API}/menu/${editingItem.id}`, payload, { withCredentials: true });
        setMessage('Menu item updated successfully!');
      } else {
        await axios.post(`${API}/menu`, payload, { withCredentials: true });
        setMessage('Menu item added successfully!');
      }
      resetForm();
      fetchMenu();
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage(error.response?.data?.detail || 'Failed to save menu item');
    }
  };

  const handleEdit = (item) => {
    setFormData({
      name: item.name,
      description: item.description,
      category: item.category,
      price: item.price.toString(),
      image_url: item.image_url || '',
      is_vegetarian: item.is_vegetarian,
      is_available: item.is_available
    });
    setEditingItem(item);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this menu item?')) return;
    try {
      await axios.delete(`${API}/menu/${id}`, { withCredentials: true });
      fetchMenu();
      setMessage('Menu item deleted');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('Failed to delete');
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
          <div className="flex justify-between items-center mb-8 flex-wrap gap-4">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
              Menu Management
            </h1>
            <button
              onClick={() => setShowForm(true)}
              data-testid="add-menu-item-btn"
              className="bg-primary hover:bg-primary-hover text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center space-x-2"
            >
              <Plus className="h-5 w-5" />
              <span>Add Menu Item</span>
            </button>
          </div>

          {message && (
            <div data-testid="menu-message" className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
              {message}
            </div>
          )}

          {showForm && (
            <div data-testid="menu-form" className="bg-card border border-border-light rounded-2xl p-6 mb-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-heading text-2xl font-medium text-text-primary">
                  {editingItem ? 'Edit Menu Item' : 'Add New Menu Item'}
                </h2>
                <button onClick={resetForm} data-testid="close-form-btn" className="text-text-secondary hover:text-text-primary">
                  <X className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Name</label>
                  <input
                    type="text"
                    required
                    data-testid="item-name-input"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Category</label>
                  <select
                    data-testid="item-category-select"
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                    className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                  >
                    <option value="Appetizer">Appetizer</option>
                    <option value="Main Course">Main Course</option>
                    <option value="Bread">Bread</option>
                    <option value="Beverage">Beverage</option>
                    <option value="Dessert">Dessert</option>
                    <option value="Snack">Snack</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-text-primary mb-2">Description</label>
                  <textarea
                    required
                    data-testid="item-description-input"
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                    rows="2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Price (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    data-testid="item-price-input"
                    value={formData.price}
                    onChange={(e) => setFormData({...formData, price: e.target.value})}
                    className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Image URL (optional)</label>
                  <input
                    type="url"
                    data-testid="item-image-input"
                    value={formData.image_url}
                    onChange={(e) => setFormData({...formData, image_url: e.target.value})}
                    className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background"
                    placeholder="https://..."
                  />
                </div>

                <div className="flex items-center space-x-6 md:col-span-2">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      data-testid="item-veg-checkbox"
                      checked={formData.is_vegetarian}
                      onChange={(e) => setFormData({...formData, is_vegetarian: e.target.checked})}
                      className="w-4 h-4 text-primary rounded focus:ring-primary"
                    />
                    <span className="text-text-primary">Vegetarian</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      data-testid="item-available-checkbox"
                      checked={formData.is_available}
                      onChange={(e) => setFormData({...formData, is_available: e.target.checked})}
                      className="w-4 h-4 text-primary rounded focus:ring-primary"
                    />
                    <span className="text-text-primary">Available</span>
                  </label>
                </div>

                <div className="md:col-span-2 flex space-x-3">
                  <button
                    type="submit"
                    data-testid="save-item-btn"
                    className="bg-primary hover:bg-primary-hover text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center space-x-2"
                  >
                    <Save className="h-5 w-5" />
                    <span>{editingItem ? 'Update' : 'Add'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="bg-background border border-border-light hover:border-text-secondary px-6 py-3 rounded-lg font-medium transition-all duration-200"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((item) => (
              <div key={item.id} data-testid={`vendor-menu-item-${item.id}`} className="bg-card border border-border-light rounded-xl overflow-hidden hover:shadow-md transition-all duration-200">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.name} className="w-full h-40 object-cover" />
                ) : (
                  <div className="w-full h-40 bg-background flex items-center justify-center">
                    <ImageIcon className="h-12 w-12 text-text-muted" />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-heading text-lg font-medium text-text-primary">{item.name}</h3>
                    {item.is_vegetarian && <Leaf className="h-5 w-5 text-green-600" />}
                  </div>
                  <p className="text-text-secondary text-sm mb-3 line-clamp-2">{item.description}</p>
                  <div className="flex justify-between items-center mb-3">
                    <p className="font-semibold text-primary text-lg">₹{item.price.toFixed(2)}</p>
                    <span className={`text-xs px-2 py-1 rounded-full ${item.is_available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {item.is_available ? 'Available' : 'Unavailable'}
                    </span>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleEdit(item)}
                      data-testid={`edit-item-${item.id}`}
                      className="flex-1 bg-background hover:bg-primary-light hover:text-primary text-text-secondary px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center space-x-1"
                    >
                      <Edit2 className="h-4 w-4" />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      data-testid={`delete-item-${item.id}`}
                      className="bg-background hover:bg-red-50 hover:text-red-600 text-text-secondary px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {items.length === 0 && !showForm && (
            <div data-testid="no-items-state" className="bg-card border border-border-light rounded-xl p-12 text-center">
              <p className="text-text-secondary mb-4">No menu items yet</p>
              <button
                onClick={() => setShowForm(true)}
                className="bg-primary hover:bg-primary-hover text-white px-6 py-3 rounded-lg font-medium transition-all duration-200"
              >
                Add Your First Item
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default VendorMenu;
