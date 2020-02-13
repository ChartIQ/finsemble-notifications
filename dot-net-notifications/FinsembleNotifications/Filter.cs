﻿using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ChartIQ.Finsemble.Notifications
{
	public class Filter
	{
		public Dictionary<String, Object> include { get; set; }
		public Dictionary<String, Object> exclude { get; set; }

		public static Filter FromJObject(JObject obj)
		{
			//convert JOBject to Filter:
			return obj.ToObject<Filter>();
		}

		public JObject ToJObject()
		{
			return JObject.FromObject(this);
		}
	}
}
