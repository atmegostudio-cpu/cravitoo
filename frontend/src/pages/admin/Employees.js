import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Navbar from '../../components/Navbar';
import { Users, Plus, X, Trash2, Mail, Building2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CorporateAdminEmployees = () => {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    department: '',
    employee_id: ''
  });

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const { data } = await axios.get(`${API}/companies/employees`, { withCredentials: true });
      setEmployees(data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/companies/employees`, formData, { withCredentials: true });
      setMessage('Employee added successfully!');
      setFormData({ email: '', password: '', name: '', department: '', employee_id: '' });
      setShowForm(false);
      fetchEmployees();
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage(error.response?.data?.detail || 'Failed to add employee');
    }
  };

  const handleRemove = async (id) => {
    if (!window.confirm('Remove this employee?')) return;
    try {
      await axios.delete(`${API}/companies/employees/${id}`, { withCredentials: true });
      fetchEmployees();
      setMessage('Employee removed');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('Failed to remove employee');
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

  // Group employees by department
  const departments = employees.reduce((acc, emp) => {
    const dept = emp.department || 'Unassigned';
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(emp);
    return acc;
  }, {});

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex justify-between items-center mb-8 flex-wrap gap-4">
            <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary">
              Employees
            </h1>
            <button
              onClick={() => setShowForm(true)}
              data-testid="add-employee-btn"
              className="bg-primary hover:bg-primary-hover text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center space-x-2"
            >
              <Plus className="h-5 w-5" />
              <span>Add Employee</span>
            </button>
          </div>

          {message && (
            <div data-testid="emp-message" className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
              {message}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div data-testid="total-employees-stat" className="bg-card border border-border-light rounded-2xl p-6">
              <div className="bg-primary-light rounded-xl p-3 w-fit mb-3">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary">{employees.length}</p>
              <p className="text-text-secondary text-sm">Total Employees</p>
            </div>
            <div data-testid="departments-stat" className="bg-card border border-border-light rounded-2xl p-6">
              <div className="bg-blue-100 rounded-xl p-3 w-fit mb-3">
                <Building2 className="h-6 w-6 text-blue-600" />
              </div>
              <p className="text-3xl font-heading font-semibold text-text-primary">{Object.keys(departments).length}</p>
              <p className="text-text-secondary text-sm">Departments</p>
            </div>
          </div>

          {showForm && (
            <div data-testid="emp-form" className="bg-card border border-border-light rounded-2xl p-6 mb-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-heading text-2xl font-medium text-text-primary">Add New Employee</h2>
                <button onClick={() => setShowForm(false)} className="text-text-secondary hover:text-text-primary">
                  <X className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Name</label>
                  <input type="text" required data-testid="emp-name-input" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Email</label>
                  <input type="email" required data-testid="emp-email-input" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Password (initial)</label>
                  <input type="password" required minLength="6" data-testid="emp-password-input" value={formData.password} onChange={(e) => setFormData({...formData, password: e.target.value})} className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Department</label>
                  <input type="text" data-testid="emp-dept-input" value={formData.department} onChange={(e) => setFormData({...formData, department: e.target.value})} placeholder="Engineering, Sales, HR..." className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Employee ID</label>
                  <input type="text" data-testid="emp-id-input" value={formData.employee_id} onChange={(e) => setFormData({...formData, employee_id: e.target.value})} placeholder="EMP-001" className="w-full px-4 py-3 border border-border-light rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-background" />
                </div>
                <div className="md:col-span-2">
                  <button type="submit" data-testid="save-emp-btn" className="bg-primary hover:bg-primary-hover text-white px-6 py-3 rounded-lg font-medium transition-all duration-200">
                    Add Employee
                  </button>
                </div>
              </form>
            </div>
          )}

          {Object.entries(departments).map(([dept, deptEmployees]) => (
            <div key={dept} className="mb-8">
              <h2 className="font-heading text-2xl font-medium text-text-primary mb-4">{dept} ({deptEmployees.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {deptEmployees.map((emp) => (
                  <div key={emp.id} data-testid={`emp-card-${emp.id}`} className="bg-card border border-border-light rounded-xl p-5 hover:shadow-md transition-all duration-200">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center space-x-3">
                        <div className="bg-primary-light w-10 h-10 rounded-full flex items-center justify-center">
                          <span className="text-primary font-semibold">{emp.name.charAt(0).toUpperCase()}</span>
                        </div>
                        <div>
                          <p className="font-medium text-text-primary">{emp.name}</p>
                          <p className="text-xs text-text-muted">{emp.employee_id || 'No ID'}</p>
                        </div>
                      </div>
                      <button onClick={() => handleRemove(emp.id)} data-testid={`remove-emp-${emp.id}`} className="text-text-secondary hover:text-red-600 transition-all duration-200">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-text-secondary">
                      <Mail className="h-4 w-4" />
                      <span className="truncate">{emp.email}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

export default CorporateAdminEmployees;
