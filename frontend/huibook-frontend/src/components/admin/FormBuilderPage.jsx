// frontend/huibook-frontend/src/components/admin/FormBuilderPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { functions } from '../../firebaseConfig';
import { httpsCallable } from 'firebase/functions';

// Define callable functions
const listFormSchemasCallable = httpsCallable(functions, 'listFormSchemas');
const createFormSchemaCallable = httpsCallable(functions, 'createFormSchema');
const getFormSchemaCallable = httpsCallable(functions, 'getFormSchema'); // For editing
const updateFormSchemaCallable = httpsCallable(functions, 'updateFormSchema');
const deleteFormSchemaCallable = httpsCallable(functions, 'deleteFormSchema');

const FIELD_TYPES = ["text", "textarea", "email", "date", "number", "dropdown", "checkbox"];

function FormBuilderPage() {
  const [formSchemas, setFormSchemas] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' or 'edit'
  
  // currentForm state
  const [currentFormId, setCurrentFormId] = useState(null);
  const [formName, setFormName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState([]); // Array of field objects

  const fetchFormSchemas = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listFormSchemasCallable();
      setFormSchemas(result.data || []);
    } catch (err) {
      setError(err.message);
      console.error("Error fetching form schemas:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFormSchemas();
  }, [fetchFormSchemas]);

  const resetFormState = () => {
    setCurrentFormId(null);
    setFormName('');
    setDescription('');
    setFields([]);
  };

  const handleOpenModal = async (mode, schemaId = null) => {
    resetFormState();
    setModalMode(mode);
    setError(null); // Clear previous errors
    if (mode === 'edit' && schemaId) {
      try {
        setIsLoading(true);
        const result = await getFormSchemaCallable({ formId: schemaId });
        const formData = result.data;
        setCurrentFormId(formData.id);
        setFormName(formData.formName);
        setDescription(formData.description || '');
        setFields(formData.fields || []);
        setIsLoading(false);
      } catch (err) {
        setError("Error fetching form details: " + err.message);
        console.error("Error fetching form details:", err);
        setIsLoading(false);
        return; // Don't open modal if fetch fails
      }
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    resetFormState();
  };

  const handleAddField = () => {
    // Basic fieldId generation, ensure it's unique later or let user edit
    const newFieldId = `field_${Date.now()}_${fields.length}`;
    setFields([...fields, { fieldId: newFieldId, label: '', type: 'text', required: false, placeholder: '', options: [] }]);
  };

  const handleRemoveField = (index) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const handleFieldChange = (index, event) => {
    const { name, value, type, checked } = event.target;
    const newFields = [...fields];
    if (type === 'checkbox') {
      newFields[index][name] = checked;
    } else if (name === 'options') {
      // Assuming comma-separated string for options input
      newFields[index][name] = value.split(',').map(opt => opt.trim()).filter(opt => opt);
    } 
    else if (name === 'fieldId') {
       // Basic sanitization for fieldId (e.g., replace spaces with underscores)
       newFields[index][name] = value.replace(/\s+/g, '_').toLowerCase();
    }
    else {
      newFields[index][name] = value;
    }
    setFields(newFields);
  };
  
 const generateFieldIdFromName = (label, index) => {
    if (!label) return `field_${index}_${Date.now()}`;
    return label.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/gi, '') + `_${index}`;
 };


  const handleSubmitFormSchema = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Auto-generate fieldId from label if empty, and ensure uniqueness
    const processedFields = fields.map((field, index) => {
        let newFieldId = field.fieldId;
        if (!newFieldId && field.label) {
            newFieldId = generateFieldIdFromName(field.label, index);
        } else if (!newFieldId) {
            newFieldId = `field_unnamed_${index}_${Date.now()}`;
        }
        // Ensure uniqueness (simple check, more robust might be needed for large forms)
        let count = 1;
        let originalId = newFieldId;
        while(fields.filter((f, i) => i !== index && f.fieldId === newFieldId).length > 0) {
            newFieldId = `${originalId}_${count++}`;
        }
        return { ...field, fieldId: newFieldId, options: field.type === 'dropdown' ? field.options : [] };
    });


    const schemaData = { formName, description, fields: processedFields };

    try {
      if (modalMode === 'create') {
        await createFormSchemaCallable(schemaData);
      } else {
        await updateFormSchemaCallable({ formId: currentFormId, ...schemaData });
      }
      fetchFormSchemas();
      handleCloseModal();
    } catch (err) {
      setError(err.message);
      console.error("Error saving form schema:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteFormSchema = async (formId) => {
    if (window.confirm("Are you sure you want to delete this form schema? This cannot be undone.")) {
      setIsLoading(true);
      setError(null);
      try {
        await deleteFormSchemaCallable({ formId });
        fetchFormSchemas();
      } catch (err) {
        setError(err.message);
        console.error("Error deleting form schema:", err);
      } finally {
        setIsLoading(false);
      }
    }
  };

  if (isLoading && !isModalOpen) return <p>Loading form schemas...</p>; // Don't show if modal is loading its own data

  return (
    <div>
      <h2>Form Builder</h2>
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      <button onClick={() => handleOpenModal('create')}>Create New Form Schema</button>
      
      <table style={{ marginTop: '20px', width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{border: '1px solid #ddd', padding: '8px'}}>Name</th>
            <th style={{border: '1px solid #ddd', padding: '8px'}}>Description</th>
            <th style={{border: '1px solid #ddd', padding: '8px'}}>Fields</th>
            <th style={{border: '1px solid #ddd', padding: '8px'}}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {formSchemas.map(schema => (
            <tr key={schema.id}>
              <td style={{border: '1px solid #ddd', padding: '8px'}}>{schema.formName}</td>
              <td style={{border: '1px solid #ddd', padding: '8px'}}>{schema.description}</td>
              <td style={{border: '1px solid #ddd', padding: '8px'}}>{schema.fieldCount}</td>
              <td style={{border: '1px solid #ddd', padding: '8px'}}>
                <button onClick={() => handleOpenModal('edit', schema.id)} style={{marginRight: '5px'}}>Edit</button>
                <button onClick={() => handleDeleteFormSchema(schema.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {isModalOpen && (
        <div className="modal" style={{ position: 'fixed', top: '5%', left: '10%', width: '80%', background: 'white', border: '1px solid #ccc', padding: '20px', zIndex: 1000, overflowY: 'auto', maxHeight: '90vh' }}>
          <h3>{modalMode === 'create' ? 'Create' : 'Edit'} Form Schema</h3>
          {isLoading && <p>Loading form details...</p>}
          {error && <p style={{ color: 'red' }}>Error: {error}</p>}
          <form onSubmit={handleSubmitFormSchema}>
            <div>
              <label>Form Name:</label>
              <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} required />
            </div>
            <div>
              <label>Description:</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}></textarea>
            </div>
            
            <h4>Fields:</h4>
            {fields.map((field, index) => (
              <div key={index} style={{ border: '1px solid #eee', padding: '10px', marginBottom: '10px' }}>
                <div>
                  <label>Field Label ({index+1}):</label>
                  <input type="text" name="label" value={field.label} onChange={(e) => handleFieldChange(index, e)} required />
                </div>
                <div>
                  <label>Field ID (auto-generated if empty, unique):</label>
                  <input type="text" name="fieldId" value={field.fieldId} onChange={(e) => handleFieldChange(index, e)} placeholder="e.g., guest_name" />
                </div>
                <div>
                  <label>Type:</label>
                  <select name="type" value={field.type} onChange={(e) => handleFieldChange(index, e)}>
                    {FIELD_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </div>
                {field.type === 'dropdown' && (
                  <div>
                    <label>Options (comma-separated):</label>
                    <input type="text" name="options" value={Array.isArray(field.options) ? field.options.join(',') : ''} onChange={(e) => handleFieldChange(index, e)} />
                  </div>
                )}
                <div>
                  <label>Placeholder:</label>
                  <input type="text" name="placeholder" value={field.placeholder || ''} onChange={(e) => handleFieldChange(index, e)} />
                </div>
                <div>
                  <input type="checkbox" name="required" checked={field.required || false} onChange={(e) => handleFieldChange(index, e)} id={`required-${index}`} />
                  <label htmlFor={`required-${index}`} style={{marginLeft: '5px'}}>Required</label>
                </div>
                <button type="button" onClick={() => handleRemoveField(index)} style={{marginTop: '5px'}}>Remove Field</button>
              </div>
            ))}
            <button type="button" onClick={handleAddField} style={{margin: '10px 0'}}>Add Field</button>
            <hr/>
            <button type="submit" disabled={isLoading} style={{marginRight: '10px'}}>{isLoading ? "Saving..." : (modalMode === 'create' ? 'Create Schema' : 'Save Changes')}</button>
            <button type="button" onClick={handleCloseModal} disabled={isLoading}>Cancel</button>
          </form>
        </div>
      )}
    </div>
  );
}
export default FormBuilderPage;
