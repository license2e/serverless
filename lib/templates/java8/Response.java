package <%= package %>;

public class Response {

	private String value;

	public Response(String value) {
		this.value = value;
	}

	public Response() {
	}

	public String getValue() {
		return this.value;
	}

	public void setValue(String value) {
		this.value = value;
	}

}
