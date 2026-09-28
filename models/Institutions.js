const mongoose = require("mongoose");

const institutionSchema = new mongoose.Schema(
	{
		name: { type: String, required: true, unique: true, trim: true },
		description: { type: String, trim: true, default: '' },
		active: { type: Boolean, default: true },
	},
	{ timestamps: true }
);

module.exports = mongoose.model('Institution', institutionSchema);
