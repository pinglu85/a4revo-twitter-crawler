import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const adminSchema = new mongoose.Schema(
  {
    username: String,
    hashedPassword: String,
  },
  {
    methods: {
      verifyPassword(password) {
        return bcrypt.compare(password, this.hashedPassword);
      },
    },
  }
);

const Admin = mongoose.model('Admin', adminSchema);

export default Admin;
